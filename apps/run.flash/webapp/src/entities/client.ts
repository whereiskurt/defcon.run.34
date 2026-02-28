import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const electroEndpoint = process.env.RUN_ELECTRO_ENDPOINT;

export const electroClient = DynamoDBDocument.from(
  new DynamoDB({
    credentials: {
      accessKeyId: process.env.RUN_ELECTRO_ID!,
      secretAccessKey: process.env.RUN_ELECTRO_SECRET!,
    },
    region: process.env.RUN_DYNAMODB_REGION,
    ...(electroEndpoint ? { endpoint: electroEndpoint } : {}),
  }),
  {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }
);

export const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
