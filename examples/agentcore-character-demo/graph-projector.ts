import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { sceneGraphProjection } from "./graph-projection";
import type { Episode } from "./scene-store";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
type Record = { eventID?: string; dynamodb?: { SequenceNumber?: string; Keys?: { owner?: { S?: string }; record?: { S?: string } } } };
export async function handler(event: { Records: Record[] }) {
  const TableName = process.env.CHARACTER_DEMO_TABLE;
  if (!TableName) throw Error("Missing projection table");
  const failures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    const keys = record.dynamodb?.Keys, owner = keys?.owner?.S, name = keys?.record?.S;
    if (!owner || !name?.startsWith("episode#")) continue;
    try {
      // Read the latest canonical state, so delayed and out-of-order batches converge.
      const current = await db.send(new GetCommand({ TableName, Key: { owner, record: name }, ConsistentRead: true }));
      const Key = { owner, record: name.replace(/^episode#/u, "graph#") };
      if (!current.Item) { await db.send(new DeleteCommand({ TableName, Key })); continue; }
      const projection = sceneGraphProjection(current.Item.data as Episode);
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { ConditionCheck: { TableName, Key: { owner, record: name }, ConditionExpression: "#rev = :rev",
            ExpressionAttributeNames: { "#rev": "rev" }, ExpressionAttributeValues: { ":rev": projection.version } } },
          { Put: { TableName, Item: { ...Key, rev: projection.version, data: projection, expires: current.Item.expires },
            ConditionExpression: "attribute_not_exists(#rev) OR #rev < :rev",
            ExpressionAttributeNames: { "#rev": "rev" }, ExpressionAttributeValues: { ":rev": projection.version } } },
        ] }));
      } catch (error) {
        const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
        if ((error as Error).name !== "TransactionCanceledException" || !reasons?.length || reasons.some(reason => !["None", "ConditionalCheckFailed"].includes(reason.Code ?? ""))) throw error;
      }
    } catch {
      failures.push({ itemIdentifier: record.dynamodb?.SequenceNumber ?? record.eventID ?? "unknown" });
    }
  }
  return { batchItemFailures: failures };
}
