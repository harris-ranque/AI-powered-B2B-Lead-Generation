export type Id<TableName extends string = string> = string & { __tableName?: TableName };
export type Doc<TableName extends string = string> = {
  _id: Id<TableName>;
  [field: string]: unknown;
};

export interface GeneratedDataModel {
  __isFallback?: boolean;
}

export declare const isFallback: boolean;
export declare function loadGeneratedDataModel(): GeneratedDataModel;
