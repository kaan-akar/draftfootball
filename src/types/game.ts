// ─── Position Types ────────────────────────────────────────────────────────
export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';
export type DetailedPosition =
  | 'GK'
  | 'RB' | 'CB' | 'LB'
  | 'CDM' | 'CM' | 'CAM' | 'RM' | 'LM'
  | 'RW' | 'LW' | 'CF' | 'ST';

// ─── Formation Types ────────────────────────────────────────────────────────
export type Formation =
  | '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2'
  | '5-3-2' | '4-5-1' | '3-4-3' | '4-1-4-1';

export interface FormationSlot {
  slotId: string;          // e.g. "CB_1", "CM_2"
  position: DetailedPosition;
  filledBy?: string;       // football_player id
}

// ─── Player / Coach Data ────────────────────────────────────────────────────
export interface FootballPlayer {
  id: string;
  name: string;
  position_group: PositionGroup;
  positions: DetailedPosition[];
  price: number;           // 1–10 TL
  peak_years: string;       // e.g. "1998-2006"
  caps: number;
  goals: number;
  bio: string;             // LLM sim context
}

export interface Coach {
  id: string;
  name: string;
  preferred_formations: Formation[];
  price: number;           // 1–10 TL
  style: string;
  bio: string;
}

// ─── Room / Lobby ───────────────────────────────────────────────────────────
export type RoomStatus =
  | 'lobby'
  | 'coach_draft'
  | 'player_draft'
  | 'squad_review'
  | 'tournament'
  | 'finished';

export interface GameRoom {
  id: string;
  hostId: string;
  joinCode: string;
  status: RoomStatus;
  maxPlayers: number;
  coachDraftBudget: number;  // default 20
  createdAt: string;
}

export interface RoomPlayer {
  roomId: string;
  userId: string;
  username: string;
  formation: Formation | null;
  playerBudget: number;    // starts 100
  coachBudget: number;     // starts 20
  objectionRights: number; // starts 3
  pickedCoachId: string | null;
  isReady: boolean;
}

// ─── Draft ──────────────────────────────────────────────────────────────────
export type DraftPhase = 'coach' | 'gk' | 'def' | 'mid' | 'fwd';

export interface DraftSession {
  roomId: string;
  currentPhase: DraftPhase;
  currentRound: number;    // 1-11 for players; 1 for coach
  pickOrder: string[];     // ordered user_ids (snake alternates)
  currentPickerIndex: number;
}

export interface DraftPick {
  id: string;
  roomId: string;
  round: number;
  pickerId: string;
  footballPlayerId?: string;
  coachId?: string;
  pickType: 'normal' | 'auction_won';
  finalPrice: number;
}

// ─── Auction ────────────────────────────────────────────────────────────────
export type AuctionStatus = 'active' | 'finished';

export interface AuctionBid {
  bidderId: string;
  amount: number;
  timestamp: string;
}

export interface Auction {
  id: string;
  room_id: string;
  pending_pick_id?: string;
  target_player_id?: string;
  target_coach_id?: string;
  initiated_by: string;
  status: AuctionStatus;
  base_price: number;
  current_highest_bid: number;
  current_highest_bidder: string | null;
  current_bidder_index: number;
  eligible_bidders: string[];
  passed_bidders: string[];
  bids: AuctionBid[];
}

export interface PendingPick {
  id: string;
  room_id: string;
  picker_id: string;
  round: number;
  phase: DraftPhase;
  football_player_id?: string;
  coach_id?: string;
  final_price: number;
  status: 'active' | 'auctioning' | 'resolved';
  eligible_objectors: string[];
  passed_by: string[];
}

// ─── Squad ──────────────────────────────────────────────────────────────────
export interface SquadSlot extends FormationSlot {
  player?: FootballPlayer;
}

export interface Squad {
  userId: string;
  formation: Formation;
  coach?: Coach;
  slots: SquadSlot[];      // exactly 11
}

// ─── Tournament / Match ─────────────────────────────────────────────────────
export type MatchStatus = 'scheduled' | 'live' | 'finished';

export interface MatchEvent {
  minute: number;
  description: string;
  type: 'goal' | 'yellow_card' | 'red_card' | 'chance' | 'save' | 'action';
  team: 'home' | 'away';
}

export interface Match {
  id: string;
  roomId: string;
  homePlayerId: string;
  awayPlayerId: string;
  round: number;
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  summary: string;
  mvp: string;
}

export interface Standing {
  roomId: string;
  userId: string;
  username: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

// ─── LLM Match Response ─────────────────────────────────────────────────────
export interface LLMMatchResponse {
  events: MatchEvent[];
  home_score: number;
  away_score: number;
  summary: string;
  mvp: string;
}
