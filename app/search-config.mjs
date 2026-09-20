// Product horizon for the shared fast browser search. Diagnostic/unit horizons
// are always passed explicitly and must not import this default by accident.
export const FAST_SEARCH_BUDGET = 40000;

// Normal wall-clock budget for the Production browser optimizer.
export const PRODUCT_SEARCH_TIME_MS = 60000;

// Production heuristic selector. Exact diagnostic paths remain explicit and
// are never selected through this default.
export const PRODUCTION_SEARCH_BACKEND = "beam";
