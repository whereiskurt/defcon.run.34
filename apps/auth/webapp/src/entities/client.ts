import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const endpoint = process.env.AUTH_DYNAMODB_ENDPOINT;

export const electroClient = DynamoDBDocument.from(
  new DynamoDB({
    credentials: {
      accessKeyId: process.env.AUTH_DYNAMODB_ID!,
      secretAccessKey: process.env.AUTH_DYNAMODB_SECRET!,
    },
    region: process.env.AUTH_DYNAMODB_REGION,
    ...(endpoint ? { endpoint } : {}),
  }),
  {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }
);

export const ELECTRO_TABLE = process.env.AUTH_ELECTRO_DBNAME || "electro";
