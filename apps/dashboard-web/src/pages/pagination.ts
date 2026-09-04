/** カーソルベースページネーションの状態。cursors[i]はi番目のページを取得する際に使ったカーソル。 */
export interface PaginationState {
  cursors: (string | undefined)[];
  pageIndex: number;
}

export const INITIAL_PAGINATION: PaginationState = { cursors: [undefined], pageIndex: 0 };

export function currentCursor(state: PaginationState): string | undefined {
  return state.cursors[state.pageIndex];
}

export function goNextPage(state: PaginationState, nextCursor: string | null): PaginationState {
  if (nextCursor === null) {
    return state;
  }
  const nextIndex = state.pageIndex + 1;
  if (nextIndex < state.cursors.length) {
    return { ...state, pageIndex: nextIndex };
  }
  return { cursors: [...state.cursors, nextCursor], pageIndex: nextIndex };
}

export function goPrevPage(state: PaginationState): PaginationState {
  return state.pageIndex === 0 ? state : { ...state, pageIndex: state.pageIndex - 1 };
}
