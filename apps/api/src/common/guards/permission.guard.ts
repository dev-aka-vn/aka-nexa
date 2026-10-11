import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

import { PermissionCheckService } from '@akane/domain';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly checker: PermissionCheckService) {}

  canActivate(_context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return true;
  }
}
