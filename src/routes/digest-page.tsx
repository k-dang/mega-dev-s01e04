import type { Hono } from 'hono';
import { readNight } from '../digest/reader.js';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';

export function registerDigestPage(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);

    if (!digest) {
      return c.html(
        <Layout title={`digest · ${night}`} lane={lane()}>
          <h1>digest · {night}</h1>
          <p class="warn">night not found</p>
        </Layout>,
        404,
      );
    }

    return c.html(
      <Layout title={`digest · ${digest.night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });
}
