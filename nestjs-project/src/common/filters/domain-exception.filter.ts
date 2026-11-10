import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import {
  DomainException,
  VideoRangeNotSatisfiableException,
} from '../exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof VideoRangeNotSatisfiableException) {
      response.setHeader('Content-Range', `bytes */${exception.fileSize}`);
    }

    response.status(exception.httpStatus).json({
      statusCode: exception.httpStatus,
      error: exception.errorCode,
      message: exception.message,
    });
  }
}
