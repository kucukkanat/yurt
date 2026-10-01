import { describe, it, expectTypeOf } from 'vitest';
import type * as v from 'valibot';
import type {
  ParsedBody,
  FileRefSchema,
  TraceStepSchema,
  ApprovalReqSchema,
  BlobRefSchema,
  MsgBody,
  AgentBody,
  ProfileBody,
  ChannelBody,
  RoleBody,
  BanBody,
  RekeyBody,
  ReactBody,
  PinBody,
  EditBody,
  DelBody,
  ApproveBody,
  FileRef,
  TraceStep,
  ApprovalReq,
  BlobRef,
} from '../src';

// The public body types are written by hand (they're what publishers build); the schemas decide what
// receivers accept. These checks (run by `tsc`) fail as soon as the two drift apart.
describe('schemas and public types', () => {
  it('parse into the public body types', () => {
    expectTypeOf<ParsedBody<'msg'>>().toExtend<MsgBody>();
    expectTypeOf<ParsedBody<'agent'>>().toExtend<AgentBody>();
    expectTypeOf<ParsedBody<'profile'>>().toExtend<ProfileBody>();
    expectTypeOf<ParsedBody<'ch.create'>>().toExtend<ChannelBody>();
    expectTypeOf<ParsedBody<'role'>>().toExtend<RoleBody>();
    expectTypeOf<ParsedBody<'ban'>>().toExtend<BanBody>();
    expectTypeOf<ParsedBody<'rekey'>>().toExtend<RekeyBody>();
    expectTypeOf<ParsedBody<'react'>>().toExtend<ReactBody>();
    expectTypeOf<ParsedBody<'pin'>>().toExtend<PinBody>();
    expectTypeOf<ParsedBody<'edit'>>().toExtend<EditBody>();
    expectTypeOf<ParsedBody<'del'>>().toExtend<DelBody>();
    expectTypeOf<ParsedBody<'approve'>>().toExtend<ApproveBody>();
  });

  it('parse nested parts into their public types', () => {
    expectTypeOf<v.InferOutput<typeof FileRefSchema>>().toExtend<FileRef>();
    expectTypeOf<v.InferOutput<typeof TraceStepSchema>>().toExtend<TraceStep>();
    expectTypeOf<v.InferOutput<typeof ApprovalReqSchema>>().toExtend<ApprovalReq>();
    expectTypeOf<v.InferOutput<typeof BlobRefSchema>>().toExtend<BlobRef>();
  });
});
