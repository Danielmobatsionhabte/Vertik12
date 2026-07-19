import { STATIC_PARAM_PLACEHOLDER } from "@/lib/static-params";
import ChildPage from "./view";

/**
 * Static export (S3 + CloudFront) pre-renders this route once with a
 * placeholder id; the CloudFront viewer-request function serves that HTML
 * for any real id, and the client reads the id from the URL.
 */
export function generateStaticParams() {
  return [{ studentId: STATIC_PARAM_PLACEHOLDER }];
}

export default function Page() {
  return <ChildPage />;
}
