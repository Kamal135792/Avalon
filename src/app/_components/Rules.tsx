export default function Rules() {
  return (
    <section className="panel">
      <details>
        <summary>How to play Avalon</summary>
        <div className="mt-4 space-y-3 text-sm">
          <p>
            5–10 players receive secret good or evil roles. Talk openly, make
            claims, and deduce whom to trust. Keep your role panel private.
          </p>
          <p>
            The leader proposes the required number of players. Everyone votes
            in secret; all votes are revealed together. A majority approves, a
            tie rejects. Five consecutive rejected teams give evil the win.
          </p>
          <p>
            Team members secretly play quest cards. Good must play Success; evil
            may play either card. One Fail defeats a quest, except quest 4 with
            7–10 players needs two. Only total card counts are revealed.
          </p>
          <p>
            Leadership passes to the next seated player after each rejection or
            completed quest. Three failed quests give evil the win. After three
            successes, the Assassin makes one final guess at Merlin: a correct
            guess gives evil the win, otherwise good wins.
          </p>
          <p>
            Merlin sees evil except Mordred, including Oberon. Evil see one
            another except Oberon; Oberon sees nobody. Percival sees Merlin and
            Morgana without knowing which is which.
          </p>
          <p>
            Lady of the Lake: after the second, third and fourth completed
            quests, if play continues, the holder inspects someone’s alignment
            privately and passes them the token. Previous holders cannot be
            chosen.
          </p>
          <p>
            Targeting: the leader may choose any unplayed quest. Quest 5 is
            locked until two quests have succeeded. Quest 4 still needs two
            fails with 7+ players.
          </p>
          <p>
            <a
              href="https://avalon.fun/pdfs/rules.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Original Avalon rulebook
            </a>
            . This app implements the original game and these two optional
            variants. Cross-game Plot cards and later Big Box expansions are not
            included.
          </p>
        </div>
      </details>
    </section>
  );
}
