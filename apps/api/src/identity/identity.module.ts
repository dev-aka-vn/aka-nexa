/**
 * The shared identity stores (IDN-08, D-104, D-110).
 *
 * `IdentityMappingRepository` and `ProfileRepository`
 * are the process's identity join and its user
 * directory. They are composed **once** here so the
 * modules that read and write them share one store:
 * the D-104 auto-provisioner (auth module) creates
 * the `real_user` the IDN-08 mapping service
 * (users module) validates against — separate
 * in-memory instances would make every existence
 * check fail, and a Mongo-backed identity store is a
 * later plan's replacement for this seam.
 *
 * The worker module composes its own instance by
 * design (its consumers run in a different process);
 * within the `api` process the stores are one.
 */

import { Module } from '@nestjs/common';

import {
  IdentityMappingRepository,
  ProfileRepository,
} from '@akane/domain';

@Module({
  providers: [IdentityMappingRepository, ProfileRepository],
  exports: [IdentityMappingRepository, ProfileRepository],
})
export class IdentityModule {}
