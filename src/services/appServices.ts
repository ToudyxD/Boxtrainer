import { BoxtrainerDb } from "../repositories/dexie/db";
import { DexieSessionRepository } from "../repositories/dexie/sessionRepository";
import { SessionService } from "./sessionService";

let sessionService: SessionService | undefined;

export function getSessionService(): SessionService {
  sessionService ??= new SessionService(new DexieSessionRepository(new BoxtrainerDb()));
  return sessionService;
}
