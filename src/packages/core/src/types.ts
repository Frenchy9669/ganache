import type EthereumFlavor from "@ganache/ethereum";
import type {
  AnyFlavor,
  ServerConfig
} from "@ganache/flavor";
import { ExternalConfig, InternalOptions } from "@ganache/options";

type NamespacedServerConfigOptions = {
  server: ServerConfig;
};

export type ProviderOptions<F extends AnyFlavor> = Parameters<F["connect"]>[0];

export type ServerOptions<F extends AnyFlavor = EthereumFlavor> = Partial<{
  [K in keyof NamespacedServerConfigOptions]: ExternalConfig<
    NamespacedServerConfigOptions[K]
  >;
}> &
Parameters<F["connect"]>[0];

export type InternalServerOptions =
  InternalOptions<NamespacedServerConfigOptions>;
