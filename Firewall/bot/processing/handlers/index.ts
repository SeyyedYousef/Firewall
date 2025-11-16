import type { UpdateHandler } from "../types.js";
import { textMessageHandler } from "./textMessage.js";
import { mediaHandler } from "./media.js";
import { membershipHandler } from "./membership.js";
import { serviceHandler } from "./service.js";
import { myChatMemberHandler } from "./myChatMember.js";
import { mandatoryMembershipHandler } from "./mandatoryMembership.js";
import { voteMuteHandler } from "./voteMute.js";
import { creditCodeRedemptionHandler } from "./creditCodeRedemption.js";

export const handlers: UpdateHandler[] = [
  myChatMemberHandler,
  membershipHandler,
  mandatoryMembershipHandler, // Add mandatory membership enforcement
  voteMuteHandler, // Add vote mute system
  creditCodeRedemptionHandler, // Add credit code redemption system
  serviceHandler,
  mediaHandler,
  textMessageHandler,
];
