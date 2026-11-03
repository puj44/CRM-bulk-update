import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import env from './config/env';
import bulkActionRoutes from './modules/bulk-actions/bulk-actions.routes';
import { apiLimiter } from './middlewares/rate-limit';
import notFound from './middlewares/not-found';
import errorHandler from './middlewares/error-handler';
import { ROUTES } from './config/constants';

const app = express();

app.set('trust proxy', env.trustProxy);

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: env.jsonBodyLimit }));
app.use(apiLimiter);

app.use(ROUTES.BULK_ACTIONS, bulkActionRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
