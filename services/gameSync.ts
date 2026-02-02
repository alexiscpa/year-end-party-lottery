import { ref, set, onValue, get, off, onDisconnect } from 'firebase/database';
import { database } from './firebaseConfig';
import type { GameState, Card, RPSChoice } from '../types';

export interface MatchViewState {
  p1Hand: Card[];
  p2Hand: Card[];
  p1Score: number;
  p2Score: number;
  p1Choice: RPSChoice;
  p2Choice: RPSChoice;
  status: 'IDLE' | 'ACTION' | 'RESULT' | 'P1_TURN' | 'P2_TURN';
  roundMessage: string;
  currentPlayer: 1 | 2;
  p1Passed: boolean;
  p2Passed: boolean;
  p1Dice: number[];
  p2Dice: number[];
  p1DiceResult: string;
  p2DiceResult: string;
}

export interface SyncedRoom {
  gameState: GameState;
  matchView: MatchViewState;
  hostConnected: boolean;
  timestamp: number;
}

// 產生 6 位數房間代碼
export const generateRoomId = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// 檢查房間是否存在
export const checkRoomExists = async (roomId: string): Promise<boolean> => {
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  return snapshot.exists();
};

// 建立房間（主持人）
export const createRoom = async (
  roomId: string,
  initialGameState: GameState,
  initialMatchView: MatchViewState
): Promise<void> => {
  const roomRef = ref(database, `rooms/${roomId}`);

  const roomData: SyncedRoom = {
    gameState: initialGameState,
    matchView: initialMatchView,
    hostConnected: true,
    timestamp: Date.now(),
  };

  await set(roomRef, roomData);

  // 設定主持人斷線時的處理
  const hostConnectedRef = ref(database, `rooms/${roomId}/hostConnected`);
  onDisconnect(hostConnectedRef).set(false);
};

// 同步遊戲狀態（主持人呼叫）
export const syncGameState = async (
  roomId: string,
  gameState: GameState
): Promise<void> => {
  const stateRef = ref(database, `rooms/${roomId}/gameState`);
  await set(stateRef, gameState);

  const timestampRef = ref(database, `rooms/${roomId}/timestamp`);
  await set(timestampRef, Date.now());
};

// 同步比賽視圖（主持人呼叫）
export const syncMatchView = async (
  roomId: string,
  matchView: MatchViewState
): Promise<void> => {
  const viewRef = ref(database, `rooms/${roomId}/matchView`);
  await set(viewRef, matchView);
};

// 訂閱房間狀態變化（觀眾呼叫）
export const subscribeToRoom = (
  roomId: string,
  onGameStateChange: (state: GameState) => void,
  onMatchViewChange: (view: MatchViewState) => void,
  onHostDisconnect: () => void
): (() => void) => {
  const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
  const matchViewRef = ref(database, `rooms/${roomId}/matchView`);
  const hostConnectedRef = ref(database, `rooms/${roomId}/hostConnected`);

  const gameStateUnsubscribe = onValue(gameStateRef, (snapshot) => {
    if (snapshot.exists()) {
      onGameStateChange(snapshot.val() as GameState);
    }
  });

  const matchViewUnsubscribe = onValue(matchViewRef, (snapshot) => {
    if (snapshot.exists()) {
      onMatchViewChange(snapshot.val() as MatchViewState);
    }
  });

  const hostConnectedUnsubscribe = onValue(hostConnectedRef, (snapshot) => {
    if (snapshot.exists() && snapshot.val() === false) {
      onHostDisconnect();
    }
  });

  // 回傳取消訂閱函數
  return () => {
    off(gameStateRef);
    off(matchViewRef);
    off(hostConnectedRef);
  };
};

// 刪除房間
export const deleteRoom = async (roomId: string): Promise<void> => {
  const roomRef = ref(database, `rooms/${roomId}`);
  await set(roomRef, null);
};
