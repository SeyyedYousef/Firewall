import type { UpdateHandler } from "../types.js";
import { textMessageHandler } from "./textMessage.js";
import { mediaHandler } from "./media.js";
import { specialContentHandler } from "./specialContent.js";
import { membershipHandler } from "./membership.js";
import { serviceHandler } from "./service.js";
import { myChatMemberHandler } from "./myChatMember.js";
import { chatMemberHandler } from "./chatMember.js";
import { mandatoryMembershipHandler } from "./mandatoryMembership.js";
import { voteMuteHandler } from "./voteMute.js";
import { creditCodeRedemptionHandler } from "./creditCodeRedemption.js";

export const handlers: UpdateHandler[] = [
  myChatMemberHandler,
  chatMemberHandler, // Handle regular users joining/leaving via invite links (chat_member updates)
  membershipHandler, // Handle old-style message.new_chat_members
  mandatoryMembershipHandler, // Add mandatory membership enforcement
  voteMuteHandler, // Add vote mute system
  creditCodeRedemptionHandler, // Add credit code redemption system
  serviceHandler,
  specialContentHandler,
  mediaHandler,
  textMessageHandler,
];
