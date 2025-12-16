import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * ElectroDB entity for storing OIDC provider models
 * Stores: Session, AccessToken, AuthorizationCode, RefreshToken,
 *         DeviceCode, ClientCredentials, Client, InitialAccessToken,
 *         RegistrationAccessToken, Interaction, ReplayDetection,
 *         PushedAuthorizationRequest, Grant, BackchannelAuthenticationRequest
 */
const OIDCModel = new Entity(
  {
    model: {
      entity: "OIDCModel",
      version: "1",
      service: "oidc",
    },
    attributes: {
      modelName: { type: "string", required: true },
      id: { type: "string", required: true },
      payload: { type: "any", required: true },
      grantId: { type: "string" },
      userCode: { type: "string" },
      uid: { type: "string" },
      consumedAt: { type: "number" },
      expiresAt: { type: "number" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["modelName"] },
        sk: { field: "sk", composite: ["id"] },
      },
      byGrant: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["grantId"] },
        sk: { field: "gsi1sk", composite: ["modelName"] },
      },
      byUid: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: ["uid"] },
        sk: { field: "gsi2sk", composite: ["modelName"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * OIDC Provider Adapter for DynamoDB via ElectroDB
 * Implements the adapter interface required by oidc-provider
 * @see https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#adapter
 */
export class OIDCAdapter {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Create or update a record
   */
  async upsert(id: string, payload: any, expiresIn?: number): Promise<void> {
    const expiresAt = expiresIn
      ? Math.floor(Date.now() / 1000) + expiresIn
      : undefined;

    await OIDCModel.upsert({
      modelName: this.name,
      id,
      payload,
      // Use placeholder values for GSI keys when not present
      grantId: payload.grantId || `_none_${this.name}_${id}`,
      userCode: payload.userCode,
      uid: payload.uid || `_none_${this.name}_${id}`,
      expiresAt,
    }).go();
  }

  /**
   * Find a record by ID
   */
  async find(id: string): Promise<any | undefined> {
    const result = await OIDCModel.get({ modelName: this.name, id }).go({ params: { ConsistentRead: true } });

    if (!result.data) {
      return undefined;
    }

    // Check expiration
    if (
      result.data.expiresAt &&
      result.data.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return undefined;
    }

    return {
      ...result.data.payload,
      ...(result.data.consumedAt ? { consumed: true } : {}),
    };
  }

  /**
   * Find by user code (device flow)
   */
  async findByUserCode(userCode: string): Promise<any | undefined> {
    const result = await OIDCModel.scan
      .where(({ userCode: uc }, { eq }) => eq(uc, userCode))
      .go();
    return result.data?.[0]?.payload;
  }

  /**
   * Find by UID (interactions and sessions)
   *
   * For Interaction models, the uid IS the id, so we can do a direct primary key lookup
   * with ConsistentRead instead of using the GSI (which has eventual consistency issues).
   * This fixes SessionNotFound errors when DynamoDB GSI replication lags behind.
   *
   * For Session models, we also try direct lookup since uid might equal id in some cases.
   * Falls back to GSI lookup for other model types.
   */
  async findByUid(uid: string): Promise<any | undefined> {
    // Try direct lookup first using the adapter's model name (uid might === id)
    // This is faster and uses ConsistentRead, avoiding GSI eventual consistency issues
    const directResult = await OIDCModel.get({ modelName: this.name, id: uid })
      .go({ params: { ConsistentRead: true } });

    if (directResult.data) {
      const item = directResult.data;
      // Check expiration
      if (item.expiresAt && item.expiresAt < Math.floor(Date.now() / 1000)) {
        return undefined;
      }
      return {
        ...item.payload,
        ...(item.consumedAt ? { consumed: true } : {}),
      };
    }

    // Fall back to GSI lookup for models where uid != id
    const gsiResult = await OIDCModel.query.byUid({ uid }).go();
    if (!gsiResult.data?.[0]) {
      return undefined;
    }

    // Then fetch from primary index with consistent read
    const { modelName, id } = gsiResult.data[0];
    const result = await OIDCModel.get({ modelName, id }).go({ params: { ConsistentRead: true } });
    if (!result.data) {
      return undefined;
    }

    const item = result.data;
    // Check expiration
    if (item.expiresAt && item.expiresAt < Math.floor(Date.now() / 1000)) {
      return undefined;
    }

    return {
      ...item.payload,
      ...(item.consumedAt ? { consumed: true } : {}),
    };
  }

  /**
   * Mark a token as consumed (one-time use)
   */
  async consume(id: string): Promise<void> {
    await OIDCModel.patch({ modelName: this.name, id })
      .set({ consumedAt: Math.floor(Date.now() / 1000) })
      .go();
  }

  /**
   * Delete a record
   */
  async destroy(id: string): Promise<void> {
    await OIDCModel.delete({ modelName: this.name, id }).go();
  }

  /**
   * Revoke all tokens associated with a grant
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    const results = await OIDCModel.query.byGrant({ grantId }).go();
    await Promise.all(
      results.data.map((item) =>
        OIDCModel.delete({ modelName: item.modelName, id: item.id }).go()
      )
    );
  }
}
