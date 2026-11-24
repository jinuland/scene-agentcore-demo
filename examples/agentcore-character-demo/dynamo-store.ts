import {PUBLIC_STORY_OWNER} from './public-stories';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { StudioError } from "../../lib/studio/store";
import type { Episode, SceneStore } from "./scene-store";
import type { Story } from "./stories";

export function dynamoStore(TableName: string): SceneStore {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const key = (owner: string, kind: "episode" | "draft", id: string) => ({ owner, record: `${kind}#${id}` });
  const time = () => Math.floor(Date.now() / 1000);
  const ttl = () => time() + 7 * 86400;
  const update = async (command: UpdateCommand) => {
    for(let attempt=0;;attempt++){
      try{return await db.send(command);}
      catch(error){
        if((error as Error).name !== "TransactionConflictException" || attempt>=4)throw error;
        await new Promise(resolve=>setTimeout(resolve,25*2**attempt+Math.floor(Math.random()*25)));
      }
    }
  };
  const conflict = (error: unknown) => (error as { name?: string })?.name === "ConditionalCheckFailedException";
  const read = async <T>(Key: ReturnType<typeof key>) => (
    await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))
  ).Item?.data as T | undefined;
  const list = async (owner: string, kind: "episode" | "draft") => {
    const rows: NonNullable<Awaited<ReturnType<typeof query>>["Items"]> = [];
    function query(ExclusiveStartKey?: Record<string, unknown>) {
      return db.send(new QueryCommand({ TableName, ExclusiveStartKey, ConsistentRead: true,
        KeyConditionExpression: "#owner = :owner AND begins_with(#record, :kind)",
        ExpressionAttributeNames: { "#owner": "owner", "#record": "record", "#data": "data", "#updated": "updated" },
        ExpressionAttributeValues: { ":owner": owner, ":kind": kind + "#" },
        ProjectionExpression: "#data, #updated",
      }));
    }
    let cursor;
    do {
      const page = await query(cursor);
      rows.push(...(page.Items ?? []));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return rows.sort((a, b) => Number(b.updated) - Number(a.updated));
  };
  const put = async (owner: string, kind: "episode" | "draft", data: Episode | Story) => {
    await db.send(new PutCommand({ TableName, Item: { ...key(owner, kind, data.id), data, rev: 0, updated: Date.now(), ...(owner===PUBLIC_STORY_OWNER?{}:{expires:ttl()}) },
      ConditionExpression: "attribute_not_exists(#record)", ExpressionAttributeNames: { "#record": "record" },
    }));
  };
  return {
    async putPublicTemplate(id,document){await db.send(new UpdateCommand({TableName,Key:key(PUBLIC_STORY_OWNER,'draft',id),UpdateExpression:'SET #d.#t = :document',ConditionExpression:'attribute_exists(#record) AND #d.#p = :yes AND attribute_not_exists(#d.#t)',ExpressionAttributeNames:{'#d':'data','#t':'publicTemplate','#p':'public','#record':'record'},ExpressionAttributeValues:{':document':document,':yes':true}}));},
    findPublicStory:id=>read<Story>(key(PUBLIC_STORY_OWNER,"draft",id)),
    async publicStories(){return(await list(PUBLIC_STORY_OWNER,"draft")).map(row=>row.data as Story);},
    putPublicStory:story=>put(PUBLIC_STORY_OWNER,"draft",story),
    findDraft: (owner, id) => read<Story>(key(owner, "draft", id)),
    async drafts(owner) { return (await list(owner, "draft")).map(row => row.data as Story); },
    async putDraft(owner, draft, expectedRevision) {
      if (expectedRevision === undefined) return put(owner,"draft",draft);
      try { await db.send(new PutCommand({TableName,Item:{...key(owner,"draft",draft.id),data:draft,updated:Date.now(),expires:ttl()},ConditionExpression:"#d.#c.#r = :r AND #d.#c.#s = :s",ExpressionAttributeNames:{"#d":"data","#c":"creator","#r":"revision","#s":"status"},ExpressionAttributeValues:{":r":expectedRevision,":s":"draft"}})); }
      catch(error){ if(conflict(error)) throw new StudioError(409,"초안이 변경됐습니다. 다시 불러와 주세요.");throw error; }
    },
    async sessions(owner) {
      return (await list(owner, "episode")).slice(0, 30).map(row => ({ id: row.data.id as string, story: row.data.story as string }));
    },
    findEpisode: (owner, id) => read<Episode>(key(owner, "episode", id)),
    putEpisode: (owner, episode) => put(owner, "episode", episode),
    async deleteEpisode(owner, id) {
      try {
        await db.send(new DeleteCommand({
          TableName, Key: key(owner, "episode", id),
          ConditionExpression: "attribute_exists(#record)", ExpressionAttributeNames: { "#record": "record" },
        }));
        return true;
      } catch (error) {
        if (conflict(error)) return false;
        throw error;
      }
    },
    async lockTurn(owner, episode, token) {
      try {
        await update(new UpdateCommand({ TableName, Key: key(owner, "episode", episode.id),
          ConditionExpression: "#rev = :rev AND (attribute_not_exists(heldUntil) OR heldUntil < :now)",
          UpdateExpression: "SET #token = :token, heldUntil = :until",
          ExpressionAttributeNames: { "#rev": "rev", "#token": "token" },
          ExpressionAttributeValues: { ":rev": episode.turns.length, ":token": token, ":now": time(), ":until": time() + 130 },
        }));
        return true;
      } catch (error) { if (conflict(error)) return false; throw error; }
    },
    async saveTurn(owner, episode, token) {
      try {
        await update(new UpdateCommand({ TableName, Key: key(owner, "episode", episode.id),
          ConditionExpression: "#token = :token AND #rev = :previous",
          UpdateExpression: "SET #data = :payload, #rev = :rev, #updated = :updated, #expires = :expires REMOVE #token, heldUntil",
          ExpressionAttributeNames: { "#data": "data", "#token": "token", "#rev": "rev", "#updated": "updated", "#expires": "expires" },
          ExpressionAttributeValues: { ":token": token, ":previous": episode.turns.length - 1, ":rev": episode.turns.length, ":payload": episode, ":updated": Date.now(), ":expires": ttl() },
        }));
      } catch (error) {
        if (conflict(error)) throw new StudioError(409, "회차가 변경됐습니다. 다시 열어 주세요.");
        throw error;
      }
    },
    async unlockTurn(owner, id, token) {
      try {
        await update(new UpdateCommand({ TableName, Key: key(owner, "episode", id),
          ConditionExpression: "#token = :token", UpdateExpression: "REMOVE #token, heldUntil",
          ExpressionAttributeNames: { "#token": "token" },
          ExpressionAttributeValues: { ":token": token },
        }));
      } catch (error) { if (!conflict(error)) throw error; }
    },
  };
}

export function dailyTurnQuota(TableName: string) {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return async () => {
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    try {
      await db.send(new UpdateCommand({ TableName, Key: { owner: "quota", record: day },
        ConditionExpression: "attribute_not_exists(#used) OR #used < :limit",
        UpdateExpression: "SET #expires = :expires ADD #used :one",
        ExpressionAttributeNames: { "#used": "used", "#expires": "expires" },
        ExpressionAttributeValues: { ":limit": 500, ":expires": Math.floor(Date.now() / 1000) + 2 * 86400, ":one": 1 },
      }));
    } catch (error) {
      if ((error as { name?: string })?.name === "ConditionalCheckFailedException") throw new StudioError(429, "오늘의 데모 대화 한도에 도달했습니다.");
      throw error;
    }
  };
}
