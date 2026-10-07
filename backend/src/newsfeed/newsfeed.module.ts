import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NewsfeedController } from './newsfeed.controller';
import { NewsfeedService } from './newsfeed.service';

@Module({
  // AuthModule for the guards' dependencies, as in every guarded module.
  imports: [AuthModule],
  controllers: [NewsfeedController],
  providers: [NewsfeedService],
})
export class NewsfeedModule {}
