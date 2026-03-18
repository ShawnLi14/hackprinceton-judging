// ============================================
// Database types matching our Supabase schema
// ============================================

export interface Event {
  id: string;
  name: string;
  set_size: number;
  target_judgings_per_team: number;
  max_judging_minutes: number;
  status: 'setup' | 'active' | 'paused' | 'completed';
  admin_code: string;
  created_at: string;
}

export interface Room {
  id: string;
  event_id: string;
  name: string;
  room_number: number;
  floor: number;
  created_at: string;
}

export interface Team {
  id: string;
  event_id: string;
  name: string;
  project_name: string | null;
  team_number: string;
  room_id: string;
  times_judged: number;
  is_active: boolean;
  created_at: string;
  // Joined fields
  room?: Room;
}

export interface Judge {
  id: string;
  event_id: string;
  name: string;
  access_code: string;
  is_active: boolean;
  current_room_id: string | null;
  sets_completed: number;
  status: 'idle' | 'active' | 'on_break';
  created_at: string;
  // Joined fields
  current_room?: Room;
  active_set?: JudgingSetWithTeams | null;
}

export interface JudgingSet {
  id: string;
  event_id: string;
  judge_id: string;
  status: 'active' | 'completed' | 'expired' | 'skipped';
  assigned_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface JudgingSetTeam {
  id: string;
  judging_set_id: string;
  team_id: string;
  visit_order: number;
  rank: number | null;
  notes: string | null;
  is_visited: boolean;
  is_absent: boolean;
  created_at: string;
  // Joined fields
  team?: Team;
}

export interface TeamLock {
  id: string;
  team_id: string;
  judging_set_id: string;
  locked_at: string;
  released_at: string | null;
}

// ============================================
// Composite / View types
// ============================================

export interface JudgingSetWithTeams extends JudgingSet {
  judging_set_teams: (JudgingSetTeam & { team: Team & { room: Room } })[];
  judge?: Judge;
}

export interface TeamWithRoom extends Team {
  room: Room;
}

export interface JudgeWithDetails extends Judge {
  active_set: JudgingSetWithTeams | null;
  elapsed_minutes: number;
}

export interface TeamStats {
  id: string;
  name: string;
  project_name: string | null;
  team_number: string;
  room_name: string;
  floor: number;
  times_judged: number;
  is_locked: boolean;
  locked_by_judge: string | null;
  average_rank: number | null;
}

export interface EventProgress {
  total_teams: number;
  total_judges: number;
  active_judges: number;
  total_sets_completed: number;
  avg_judgings_per_team: number;
  min_judgings: number;
  max_judgings: number;
  teams_at_target: number;
  target_judgings: number;
}
