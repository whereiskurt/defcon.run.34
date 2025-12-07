import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const dynamodbEndpoint = process.env.RUN_DYNAMODB_ENDPOINT;
const electroEndpoint = process.env.RUN_ELECTRO_ENDPOINT;

// Auth.js/NextAuth DynamoDB client - for session/user management
export const dynamodbClient = DynamoDBDocument.from(
  new DynamoDB({
    credentials: {
      accessKeyId: process.env.RUN_DYNAMODB_ID!,
      secretAccessKey: process.env.RUN_DYNAMODB_SECRET!,
    },
    region: process.env.RUN_DYNAMODB_REGION,
    ...(dynamodbEndpoint ? { endpoint: dynamodbEndpoint } : {}),
  }),
  {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }
);

// ElectroDB client - for run user/profile data
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

export const DYNAMODB_TABLE = process.env.RUN_DYNAMODB_DBNAME || "run-authjs";
export const ELECTRO_TABLE = process.env.RUN_ELECTRO_DBNAME || "run-electro";
