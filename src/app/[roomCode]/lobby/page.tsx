import LobbyClient from "./LobbyClient";

export default async function LobbyPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;

  return <LobbyClient roomCode={roomCode.toUpperCase()} />;
}
