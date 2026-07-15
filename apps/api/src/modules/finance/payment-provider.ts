import Stripe from "stripe";
import { env } from "../../config/env";

/**
 * Payment gateway abstraction.
 *
 * The finance service only talks to this interface, so swapping Stripe for
 * PayPal, Flutterwave, M-Pesa, etc. means writing one new class — nothing
 * else in the system changes.
 *
 * - With STRIPE_SECRET_KEY set → real Stripe Checkout sessions.
 * - Without it → MockProvider, which returns a fake checkout URL and lets
 *   the demo flow complete instantly (payment is auto-confirmed).
 */
export interface CheckoutSession {
  provider: "STRIPE" | "MOCK";
  sessionId: string;
  checkoutUrl: string;
  /** Mock provider confirms immediately; Stripe confirms via webhook. */
  autoConfirmed: boolean;
}

export interface PaymentProvider {
  readonly name: "STRIPE" | "MOCK";
  createCheckout(params: {
    invoiceNumber: string;
    description: string;
    amount: number; // minor units
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<CheckoutSession>;
}

class StripeProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(params: Parameters<PaymentProvider["createCheckout"]>[0]): Promise<CheckoutSession> {
    // Stripe replaces {CHECKOUT_SESSION_ID} on redirect; the web app posts
    // it back to /finance/payments/confirm so the payment is verified even
    // without a webhook endpoint (essential for local/sandbox testing).
    const glue = params.successUrl.includes("?") ? "&" : "?";
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: { name: `Invoice ${params.invoiceNumber}`, description: params.description },
            unit_amount: params.amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${params.successUrl}${glue}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });
    return {
      provider: "STRIPE",
      sessionId: session.id,
      checkoutUrl: session.url ?? params.successUrl,
      autoConfirmed: false,
    };
  }

  /** Ask Stripe whether the hosted checkout was actually paid. */
  async isSessionPaid(sessionId: string): Promise<boolean> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return session.payment_status === "paid";
  }

  /** Verify a webhook's signature and return the parsed event. */
  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    return this.stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  }
}

class MockProvider implements PaymentProvider {
  readonly name = "MOCK" as const;

  async createCheckout(params: Parameters<PaymentProvider["createCheckout"]>[0]): Promise<CheckoutSession> {
    const sessionId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    // In demo mode the "gateway" approves instantly; the caller marks the
    // payment SUCCEEDED and redirects straight to the success URL.
    return { provider: "MOCK", sessionId, checkoutUrl: params.successUrl, autoConfirmed: true };
  }
}

export const paymentProvider: PaymentProvider = env.STRIPE_SECRET_KEY
  ? new StripeProvider(env.STRIPE_SECRET_KEY)
  : new MockProvider();

export const stripeProviderOrNull = (): StripeProvider | null =>
  paymentProvider instanceof StripeProvider ? paymentProvider : null;
