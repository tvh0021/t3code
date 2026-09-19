/**
 * ZedAdapter — shape type for the Zed provider adapter.
 *
 * @module ZedAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * ZedAdapterShape — per-instance Zed adapter contract.
 */
export interface ZedAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
