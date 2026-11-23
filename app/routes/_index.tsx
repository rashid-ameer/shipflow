import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  return redirect("/app" + new URL(request.url).search);
}
