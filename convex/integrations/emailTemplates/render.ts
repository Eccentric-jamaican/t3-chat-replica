import { render } from "@react-email/render";
import React from "react";

export async function renderEmail(element: React.ReactElement) {
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}
