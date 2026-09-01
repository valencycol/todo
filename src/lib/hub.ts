export async function broadcast(env: Env, event: { type: string }): Promise<void> {
  const stub = env.BROADCAST_HUB.getByName("global");
  await stub.broadcast(event);
}
