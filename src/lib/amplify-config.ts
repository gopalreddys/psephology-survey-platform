import { Amplify } from "aws-amplify";

let configured = false;

export function configureAmplify() {
  if (configured) {
    return;
  }

  const userPoolId =
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;

  const userPoolClientId =
    process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID;

  if (!userPoolId || !userPoolClientId) {
    throw new Error(
      "Missing Cognito environment configuration"
    );
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,

        loginWith: {
          email: true
        },

        signUpVerificationMethod: "code",

        userAttributes: {
          email: {
            required: true
          }
        }
      }
    }
  });

  configured = true;
}
