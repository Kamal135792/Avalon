import GameClient from "./GameClient";

export default async function GamePage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;

  return <GameClient roomCode={roomCode.toUpperCase()} />;
}
