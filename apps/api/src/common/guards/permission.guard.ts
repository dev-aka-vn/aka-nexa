import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PermissionCheckService } from '../../../../../packages/domain/src/authz/permission-check.service.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly checker: PermissionCheckService) {}

  canActivate(_context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return true;
  }
}
