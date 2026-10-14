export { roleManagementRouter } from "./router/index.js";
// appRouter(apps/dashboard-api)がroleManagementRouterの戻り値型を推論する際に必要(TS2883対策)。
export type { ListRolesResult } from "./application/index.js";
export type { RoleListItem } from "./domain/index.js";
