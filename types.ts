
export interface Character {
  id: string;
  name: string;
  role: string;
  gradient: string;
  image: string;
  stats: {
    power: number;
    agility: number;
    intelligence: number;
  };
  bio: string;
  voiceActor: string;
}

export interface EditHistory {
  id: string;
  prompt: string;
  imageUrl: string;
  timestamp: number;
}
