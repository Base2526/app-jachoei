// apollo/client.ts
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
} from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from "@apollo/client/errors";

const errorLink = new ErrorLink(({ error, operation }) => {
  // GraphQL errors (จาก server)
  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log(
        "[GraphQL error]",
        "\n message:", e.message,
        "\n locations:", e.locations,
        "\n path:", e.path,
        "\n operation:", operation.operationName
      );
    });
    return;
  }

  // Protocol errors (response shape ผิด spec)
  if (CombinedProtocolErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log(
        "[Protocol error]",
        "\n message:", e.message,
        "\n extensions:", e.extensions
      );
    });
    return;
  }

  // Network / unknown
  if (error) console.log("[Network error]", error);
});

const httpLink = new HttpLink({
  uri: "https://jachoei.com/api/graphql",
});

export const client = new ApolloClient({
  link: ApolloLink.from([errorLink, httpLink]),
  cache: new InMemoryCache(),
});
