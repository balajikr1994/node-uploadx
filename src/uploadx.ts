import * as bytes from 'bytes';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import * as createError from 'http-errors';
import * as getRawBody from 'raw-body';
import { Store, UploadxFile } from './storage';
import debug = require('debug');
const log = debug('uploadx:main');

declare global {
  namespace Express {
    interface Request {
      user: any;
      file: UploadxFile;
    }
  }
}

export type UploadxConfig = {
  destination?: string | Function;
  maxUploadSize?: number | string;
  maxChunkSize?: number | string;
  allowMIME?: string[];
};

export function uploadx({
  destination,
  maxUploadSize = Number.MAX_SAFE_INTEGER,
  maxChunkSize = Number.MAX_SAFE_INTEGER,
  allowMIME = [`\/`]
}: UploadxConfig): (
  req: Request,
  res: Response,
  next: NextFunction
) => RequestHandler {
  // init database
  const storage = new Store(destination);

  /**
   * Create new
   */
  const create: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.user) {
      return next(createError(401));
    }
    const mimetype = req.get('x-upload-content-type');
    const size = +req.get('x-upload-content-length');
    if (!mimetype) {
      return next();
    }
    if (size > bytes.parse(maxUploadSize)) {
      return next(createError(413));
    }
    if (!new RegExp(allowMIME.join('|')).test(mimetype)) {
      return next(createError(415));
    }

    const file: UploadxFile = storage.create({
      metadata: req.body,
      mimetype,
      size,
      user: req.user
    });
    if (file.destination) {
      const query = Object.keys(req.query).reduce(
        (acc, key) => acc + `&${key}=${req.query[key]}`,
        `?upload_id=${file.id}`
      );
      log('query: ', query);
      const location = `${req.protocol}://${req.get('Host') +
        req.baseUrl}?upload_id=${file.id}`;
      log('location: %s', location);
      res.location(location);
      res.sendStatus(201);
    } else {
      next(createError(500));
    }
  };

  /**
   * List sessions
   */
  const find: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.user) {
      return next(createError(401));
    }
    if (req.query.upload_id) {
      const [file] = storage.find({ user: req.user, id: req.query.upload_id });
      if (!file) {
        return next(createError(404));
      }
      res.json(file);
    } else {
      res.json(storage.find({ user: req.user }));
    }
  };

  /**
   * Cancel upload session
   */
  const remove: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.user) {
      return next(createError(401));
    }
    if (!req.query.upload_id) {
      return next(createError(400));
    }
    const [toRemove] = storage.find({
      user: req.user,
      id: req.query.upload_id
    });
    if (toRemove) {
      storage.remove(toRemove.id);
      res.sendStatus(204);
    } else {
      return next(createError(404));
    }
  };

  /**
   * Save content
   */
  const save: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!req.query.upload_id) {
      return next(createError(404));
    }
    const file = storage.findById(req.query.upload_id);
    if (!file) {
      return next(createError(404));
    }
    if (+req.get('content-length') > maxChunkSize) {
      return next(createError(413));
    }
    const contentRange = req.get('content-range');
    // ---------- resume upload ----------
    if (contentRange && contentRange.includes('*')) {
      const [, total] = contentRange.match(/\*\/(\d+)/g);
      if (+total === file.bytesWritten) {
        req.file = Object.assign({}, file);
        storage.remove(file.id);
        return next();
      } else {
        res.set('Range', `bytes=0-${file.bytesWritten - 1}`);
        res.status(308).send('Resume Incomplete');
        return;
      }
    }
    try {
      const buf = await getRawBody(req, { limit: maxChunkSize });
      if (!contentRange) {
        // -------- full file --------
        await storage.write(file, buf);
        req.file = Object.assign({}, file);
        storage.remove(file.id);
        next();
      } else {
        // --------- by chunks ---------
        const [, , , total] = contentRange
          .match(/(\d+)-(\d+)\/(\d+)/)
          .map(s => +s);
        await storage.write(file, buf);
        if (file.bytesWritten < total) {
          res.set('Range', `bytes=0-${file.bytesWritten - 1}`);
          res.status(308).send('Resume Incomplete');
        } else {
          req.file = Object.assign({}, file);
          storage.remove(file.id);
          next();
        }
      }
    } catch (err) {
      next(createError(500));
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    log('%s query: %o headers: %o', req.method, req.query, req.headers);
    let handler: RequestHandler = (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      return next();
    };
    switch (req.method) {
      case 'PUT':
        handler = save(req, res, next);
        break;
      case 'POST':
        handler = create(req, res, next);
        break;
      case 'GET':
        handler = find(req, res, next);
        break;
      case 'DELETE':
        handler = remove(req, res, next);
        break;
      default:
        break;
    }
    return handler;
  };
}
