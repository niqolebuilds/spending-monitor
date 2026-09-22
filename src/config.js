// All deployment-shaped choices come from the environment, so the same build
// runs on a laptop, an on-prem server or a container without edits.
export function loadConfig(env = process.env) {
  return {
    sourceId: env.SPEND_SOURCE ?? 'fixture',
    dataDir: env.SPEND_DATA_DIR ?? null,
    periodId: env.SPEND_PERIOD ?? null,
    port: Number(env.PORT ?? 3000),
    actor: env.SPEND_ACTOR ?? 'HO Finance'
  };
}
