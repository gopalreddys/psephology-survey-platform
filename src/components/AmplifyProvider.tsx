"use client";

import { ReactNode } from "react";
import { Authenticator } from "@aws-amplify/ui-react";

import "@aws-amplify/ui-react/styles.css";

import { configureAmplify } from "@/lib/amplify-config";

configureAmplify();

export default function AmplifyProvider({
  children
}: {
  children: ReactNode;
}) {
  return (
    <Authenticator.Provider>
      {children}
    </Authenticator.Provider>
  );
}
