import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:3000";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
) {
  const session =
    await fetchAuthSession();

  const token =
    session.tokens
      ?.accessToken
      ?.toString();

  if (!token) {
    throw new Error(
      "No authenticated Cognito session"
    );
  }

  const isFormData =
    options.body instanceof FormData;

  const headers =
    new Headers(
      options.headers || {}
    );

  headers.set(
    "Authorization",
    `Bearer ${token}`
  );

  /*
   * IMPORTANT:
   *
   * For normal JSON requests we explicitly
   * set application/json.
   *
   * For FormData / file uploads we must NOT
   * set Content-Type manually.
   *
   * The browser will automatically generate:
   *
   * multipart/form-data;
   * boundary=----WebKitFormBoundary...
   */
  if (!isFormData) {
    if (
      !headers.has(
        "Content-Type"
      )
    ) {
      headers.set(
        "Content-Type",
        "application/json"
      );
    }
  } else {
    /*
     * Defensive cleanup:
     * if a caller accidentally supplied a
     * Content-Type header for FormData,
     * remove it so the browser can create
     * the multipart boundary correctly.
     */
    headers.delete(
      "Content-Type"
    );
  }

  const response =
    await fetch(
      `${API_BASE_URL}${path}`,
      {
        ...options,
        headers
      }
    );

  /*
   * Handle JSON responses when possible.
   * Some infrastructure/application errors
   * may return HTML or plain text instead.
   */
  const responseText =
    await response.text();

  let body: any = {};

  if (responseText) {
    try {
      body =
        JSON.parse(
          responseText
        );
    } catch {
      body = {
        message:
          responseText
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      body.error ||
      body.message ||
      `API returned ${response.status}`
    );
  }

  return body;
}
