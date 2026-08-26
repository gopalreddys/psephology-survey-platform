import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:3000";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
) {
  const session = await fetchAuthSession();

  const token =
    session.tokens?.accessToken?.toString();

  if (!token) {
    throw new Error(
      "No authenticated Cognito session"
    );
  }

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${token}`,

        ...(options.headers || {})
      }
    }
  );

  const body =
    await response
      .json()
      .catch(function () {
        return {};
      });

  if (!response.ok) {
    throw new Error(
      body.error ||
      `API returned ${response.status}`
    );
  }

  return body;
}
