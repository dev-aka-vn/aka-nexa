import { Injectable } from '@nestjs/common';
import { IdentityMappingRepository } from './identity-mapping.repository.js';

@Injectable()
export class IdentityService {
  constructor(private readonly repo: IdentityMappingRepository) {}

  async resolveChat(platform: string, chat_user_id: string) {
    return this.repo.findByChat(platform, chat_user_id);
  }

  async search(params: { email?: string; real_user_id?: string; chat_user_id?: string; platform?: string }) {
    if (params.email) return this.repo.findByEmail(params.email);
    if (params.real_user_id) return this.repo.findByRealUserId(params.real_user_id);
    if (params.chat_user_id && params.platform) return this.repo.findByChat(params.platform, params.chat_user_id);
    return null;
  }
}
