
export interface Participant {
  id: string;
  name: string;
}

export type RPSChoice = 'ROCK' | 'PAPER' | 'SCISSORS' | null;

export interface Card {
  suit: '♠' | '♥' | '♦' | '♣';
  suitValue: number; // ♠=4, ♥=3, ♦=2, ♣=1
  value: string;
  points: number;
  rank: number; // A=1...K=13
}

export interface Match {
  p1: Participant;
  p2: Participant | null;
  winner: Participant | null;
  gameData: {
    logs: string[];
  };
}

export enum GameStage {
  SETUP = 'SETUP',
  ROUND_PREPARING = 'ROUND_PREPARING',
  SIMULATING_MATCHES = 'SIMULATING_MATCHES',
  WINNER = 'WINNER'
}

export interface GameState {
  stage: GameStage;
  roundNumber: number;
  allParticipants: Participant[];
  currentPool: Participant[];
  matches: Match[];
  currentMatchIndex: number;
  winnersOfRound: Participant[];
  mcCommentary: string;
  isSimulating: boolean;
  finalWinner: Participant | null;
}

// 房間連線模式
export type RoomMode = 'selecting' | 'host' | 'viewer';
