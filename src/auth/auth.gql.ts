import { gql } from "@apollo/client";

export const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    loginUser(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;

export const LOGIN_SOCIAL = gql`
  mutation LoginWithSocial($input: SocialLoginInput!) {
    loginWithSocial(input: $input) {
      ok
      message
      token
      user { id name email role }
    }
  }
`;
