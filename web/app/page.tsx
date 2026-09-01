import type { Metadata } from 'next';
import Link from 'next/link';
import {
    BookOpen, CalendarDays, Church, Coins, HandHeart, HeartHandshake,
    MapPin, ShieldCheck, Users,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './landing.module.css';

export const metadata: Metadata = {
    title: 'Catholic Men Association, Changamwe',
    description:
        'The Catholic Men Association at St. Mary\'s Changamwe Parish, Mombasa. Commissioned in 2012, '
        + 'organised across six prayer houses, working through the spiritual, stewardship and welfare pillars.',
    // The one page meant to be found. Everything behind the sign-in stays out
    // of the index, as the root layout requires.
    robots: { index: true, follow: true },
    openGraph: {
        title: 'Catholic Men Association, Changamwe',
        description: 'A movement of Catholic men at St. Mary\'s Changamwe Parish, Mombasa. Good family; good church.',
        type: 'website',
    },
};

/** Re-rendered every ten minutes, so the programme stays current. */
export const revalidate = 600;

interface PublicEvent {
    title: string;
    date: string;
    type: string;
    prayer_house: string | null;
}

const EVENT_NAMES: Record<string, string> = {
    mass: 'Mass',
    dominica: 'Dominica',
    prayer_house_meeting: 'Prayer house meeting',
    novena: 'Novena',
    seminar: 'Seminar',
    pilgrimage: 'Pilgrimage',
    national_prayer_day: 'National Prayer Day',
    family_day: 'Family Day',
    agm: 'Annual General Meeting',
    special_general_meeting: 'Special General Meeting',
    choir: 'Choir',
    act_of_mercy: 'Act of mercy',
    mentorship: 'Mentorship',
    sports: 'Sports',
    shg_activity: 'Self Help Group',
};

async function upcomingEvents(): Promise<PublicEvent[]> {
    const origin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';
    try {
        const res = await fetch(`${origin}/api/public/events?limit=8`, {
            next: { revalidate: 600 },
        });
        if (!res.ok) return [];
        const body = await res.json() as { events?: PublicEvent[] };
        return body.events ?? [];
    }
    catch {
        // The programme is worth showing when it is there, and never worth
        // taking the page down for.
        return [];
    }
}

function formatDate(iso: string): { day: string; month: string; full: string } {
    const d = new Date(`${iso}T12:00:00+03:00`);
    const nairobi = { timeZone: 'Africa/Nairobi' } as const;
    return {
        day: new Intl.DateTimeFormat('en-GB', { ...nairobi, day: 'numeric' }).format(d),
        month: new Intl.DateTimeFormat('en-GB', { ...nairobi, month: 'short' }).format(d),
        full: new Intl.DateTimeFormat('en-GB', { ...nairobi, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d),
    };
}

const PILLARS = [
    {
        icon: Church,
        name: 'Spiritual',
        lead: 'The life of prayer that holds the rest together.',
        items: [
            'Weekly mass, on Wednesday or Friday',
            'Dominica on the first Sunday of the month',
            'Prayer house meetings on the second and fourth Monday',
            'Novena before the feasts of St. Joseph, and at times of need',
            'Pilgrimage to Bura with the archdiocese, and to Subukia nationally',
        ],
    },
    {
        icon: BookOpen,
        name: 'Stewardship',
        lead: 'Equipping a man for the work he already has.',
        items: [
            'Seminars on fatherhood, leadership, money and health',
            'A mentorship programme for boys',
            'A Self Help Group and other saving platforms',
            'Sports, for healthy living',
        ],
    },
    {
        icon: HandHeart,
        name: 'Welfare',
        lead: 'Standing with a brother when it costs something.',
        items: [
            'Support towards a wedding',
            'Support during a long hospital admission',
            'Benevolent support on the death of a member, spouse, child or parent',
            'Family Day each November, with thanksgiving mass and a shared meal',
        ],
    },
];

const HISTORY = [
    { year: '1983', text: 'The association is launched in Kenya, at Nakuru Diocese, by missionaries from Austria.' },
    { year: '2009', text: 'The first commissioning in Mombasa takes place at Migombani Parish.' },
    { year: '2012', text: 'Changamwe commissions its first group of 74 men in January, and a further 20 in May.' },
    { year: 'Today', text: 'Membership stands at 435 men across six prayer houses.' },
];

const QUESTIONS = [
    {
        q: 'Who can join?',
        a: 'Any Catholic man of the parish. Members come through their prayer house, and are '
            + 'commissioned together as a group once formation is complete.',
    },
    {
        q: 'How do I join?',
        a: 'Speak to the coordinator of the prayer house nearest you, or to any officer after Sunday '
            + 'mass. Registration is completed online once your prayer house has received you.',
    },
    {
        q: 'What does membership involve?',
        a: 'A yearly affiliation to the diocese and the deanery, a monthly subscription, and a share '
            + 'towards seminars, weddings and the benevolent fund as they arise. The amounts are set '
            + 'in the by-laws and are given to you on joining.',
    },
    {
        q: 'When do you meet?',
        a: 'Mass each week on Wednesday or Friday. Dominica on the first Sunday of the month. Prayer '
            + 'houses meet on the second and fourth Monday. The Annual General Meeting is the third '
            + 'Sunday of January.',
    },
    {
        q: 'What is a prayer house?',
        a: 'The parish is large, so members gather in six smaller groups by where they live. The '
            + 'prayer house is where a man is known, and it is the foundation of the leadership '
            + 'structure above it.',
    },
    {
        q: 'How is welfare support decided?',
        a: 'By participation, recorded and scored the same way for everyone. Attendance carries sixty '
            + 'points and financial obligation forty. A member in good standing at the close of a '
            + 'month qualifies for the support the by-laws set out.',
    },
    {
        q: 'Is the association part of the parish?',
        a: 'Yes. It sits under St. Mary\'s Changamwe Parish in the Archdiocese of Mombasa, with a '
            + 'priest as chaplain overseeing its activities.',
    },
];

export default async function LandingPage() {
    const events = await upcomingEvents();

    return (<div className={styles.page}>
      <a className="skipLink" href="#main">Skip to main content</a>

      <header className={styles.masthead}>
        <div className={styles.bar}>
          <span className={styles.brand}>
            <span className={styles.mark} aria-hidden="true"/>
            <span>
              <span className={styles.brandName}>CMA Changamwe</span>
              <span className={styles.brandSub}>Catholic Men Association</span>
            </span>
          </span>
          <nav className={styles.nav} aria-label="Sections">
            <a href="#about">About</a>
            <a href="#pillars">What we do</a>
            <a href="#programme">Programme</a>
            <a href="#join">Join</a>
            <Link className={`btn btnSecondary ${styles.portalLink}`} href="/sign-in">Member portal</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <p className={styles.motto}>Good family; good church</p>
            <h1 className={styles.title}>
              A movement of Catholic men at St. Mary&apos;s Changamwe
            </h1>
            <p className={styles.lead}>
              Commissioned in this parish in 2012 and now 435 strong, meeting across six prayer
              houses to pray together, to grow as fathers and husbands, and to stand with one
              another when it matters.
            </p>
            <div className={styles.heroActions}>
              <a className="btn btnPrimary" href="#join">How to join</a>
              <a className="btn btnSecondary" href="#programme">See the programme</a>
            </div>
          </div>
        </section>

        <section id="about" className={styles.section} aria-labelledby="about-h">
          <div className={styles.inner}>
            <p className="label">Who we are</p>
            <h2 id="about-h" className={styles.h2}>
              A faith-based association of Catholic men, governed by its own constitution
            </h2>

            <div className={styles.threeUp}>
              <article>
                <h3>Vision</h3>
                <p className={styles.big}>Eternal life for humanity.</p>
                <p className={styles.muted}>
                  Taken from Canon Law 1752, the salvation of souls being the highest law.
                </p>
              </article>
              <article>
                <h3>Goal</h3>
                <p>
                  To foster the union of Catholic men, to promote the Catholic faith, and to work
                  with the church in evangelization.
                </p>
              </article>
              <article>
                <h3>Mission</h3>
                <p>
                  The universal aim of the church: the evangelization and sanctification of
                  humanity, and the Christian formation of conscience, under the Code of Canon Law
                  and the guidance of the Kenya Conference of Catholic Bishops.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="pillars" className={`${styles.section} ${styles.tinted}`} aria-labelledby="pillars-h">
          <div className={styles.inner}>
            <p className="label">What we do</p>
            <h2 id="pillars-h" className={styles.h2}>Three pillars, set out in the by-laws</h2>

            <div className={styles.pillars}>
              {PILLARS.map(({ icon: Icon, name, lead, items }) => (
                <article key={name} className={styles.pillar}>
                  <Icon size={22} aria-hidden="true" className={styles.pillarIcon}/>
                  <h3>{name}</h3>
                  <p className={styles.pillarLead}>{lead}</p>
                  <ul>
                    {items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="programme" className={styles.section} aria-labelledby="programme-h">
          <div className={styles.inner}>
            <p className="label">Programme</p>
            <h2 id="programme-h" className={styles.h2}>What is coming up</h2>

            {events.length > 0 ? (
              <ul className={styles.events}>
                {events.map((e) => {
                    const d = formatDate(e.date);
                    return (
                      <li key={`${e.date}-${e.title}`} className={styles.event}>
                        <time className={styles.date} dateTime={e.date} aria-label={d.full}>
                          <span className={styles.day}>{d.day}</span>
                          <span className={styles.month}>{d.month}</span>
                        </time>
                        <div>
                          <p className={styles.eventTitle}>{e.title}</p>
                          <p className={styles.eventMeta}>
                            {EVENT_NAMES[e.type] ?? e.type.replace(/_/g, ' ')}
                            {e.prayer_house ? ` · ${e.prayer_house}` : ''}
                          </p>
                        </div>
                      </li>
                    );
                })}
              </ul>
            ) : (
              <p className={styles.empty}>
                <CalendarDays size={18} aria-hidden="true"/>
                The calendar for the coming weeks is not published yet. The regular rhythm below
                continues, and any officer can tell you what is planned.
              </p>
            )}

            <div className={styles.rhythm}>
              <h3>The regular rhythm</h3>
              <dl>
                <div><dt>Every week</dt><dd>Mass, on Wednesday or Friday</dd></div>
                <div><dt>First Sunday</dt><dd>Dominica</dd></div>
                <div><dt>Second and fourth Monday</dt><dd>Prayer house meetings</dd></div>
                <div><dt>Third Sunday of January</dt><dd>Annual General Meeting</dd></div>
                <div><dt>November</dt><dd>Family Day, with thanksgiving mass and a shared meal</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.tinted}`} aria-labelledby="houses-h">
          <div className={styles.inner}>
            <p className="label">Where we meet</p>
            <h2 id="houses-h" className={styles.h2}>Six prayer houses across the parish</h2>
            <p className={styles.sectionLead}>
              The parish is large, so members gather where they live. The prayer house is where a
              man is known by name, and it carries its own coordinator, secretary and treasurer.
            </p>
            <ul className={styles.houses}>
              {['Noor', 'Railway/National Housing', 'Malandi', 'Magongo', 'Chaani/Migadini', 'Hamisi']
                  .map((h) => (
                    <li key={h}>
                      <MapPin size={15} aria-hidden="true"/>
                      {h}
                    </li>
                  ))}
            </ul>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="history-h">
          <div className={styles.inner}>
            <p className="label">How we got here</p>
            <h2 id="history-h" className={styles.h2}>From Nakuru in 1983 to Changamwe today</h2>
            <ol className={styles.history}>
              {HISTORY.map(({ year, text }) => (
                <li key={year}>
                  <span className={styles.year}>{year}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="join" className={`${styles.section} ${styles.tinted}`} aria-labelledby="join-h">
          <div className={styles.inner}>
            <p className="label">Joining</p>
            <h2 id="join-h" className={styles.h2}>Any Catholic man of this parish is welcome</h2>

            <div className={styles.joinGrid}>
              <article>
                <Users size={20} aria-hidden="true" className={styles.pillarIcon}/>
                <h3>Start where you live</h3>
                <p>
                  Speak to the coordinator of the prayer house nearest you, or to any officer after
                  Sunday mass. New members are received by a prayer house and commissioned together
                  as a group once formation is complete.
                </p>
              </article>
              <article>
                <Coins size={20} aria-hidden="true" className={styles.pillarIcon}/>
                <h3>What it asks of you</h3>
                <p>
                  A yearly affiliation to the diocese and the deanery, a monthly subscription, and a
                  share towards seminars, weddings and the benevolent fund as they arise. The
                  amounts are set in the by-laws and given to you on joining.
                </p>
              </article>
              <article>
                <HeartHandshake size={20} aria-hidden="true" className={styles.pillarIcon}/>
                <h3>What it gives back</h3>
                <p>
                  Brothers who know you, formation you will use at home, and an association that
                  stands with your family at a wedding, a long illness or a funeral.
                </p>
              </article>
            </div>

            <p className={styles.joinNote}>
              Already received by a prayer house?{' '}
              <Link href="/register">Complete your registration</Link>. You can save your progress
              and come back to it.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="questions-h">
          <div className={styles.inner}>
            <p className="label">Questions</p>
            <h2 id="questions-h" className={styles.h2}>Quick answers</h2>
            <div className={styles.faq}>
              {QUESTIONS.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.inner}>
          <div className={styles.footerGrid}>
            <div>
              <span className={styles.brand}>
                <span className={styles.mark} aria-hidden="true"/>
                <span>
                  <span className={styles.brandName}>CMA Changamwe</span>
                  <span className={styles.brandSub}>Catholic Men Association</span>
                </span>
              </span>
              <p className={styles.footerNote}>
                Good family; good church.
              </p>
            </div>

            <nav aria-label="This site" className={styles.siteNav}>
              <h3>This site</h3>
              <ul>
                <li><a href="#about">About the association</a></li>
                <li><a href="#pillars">What we do</a></li>
                <li><a href="#programme">Programme</a></li>
                <li><a href="#join">How to join</a></li>
              </ul>
            </nav>

            <nav aria-label="Members">
              <h3>Members</h3>
              <ul>
                <li><Link href="/sign-in">Member portal</Link></li>
                <li><Link href="/register">Register</Link></li>
                <li><Link href="/forgot-password">Forgotten password</Link></li>
              </ul>
            </nav>

            <nav aria-label="The parish">
              <h3>The parish</h3>
              <ul>
                <li>
                  <a href="https://www.stmaryschangamwe.org" target="_blank" rel="noreferrer noopener">
                    St. Mary&apos;s Changamwe
                  </a>
                </li>
                <li className={styles.plain}>Archdiocese of Mombasa</li>
              </ul>
            </nav>
          </div>

          <div className={styles.footerBase}>
            <p>
              The Catholic Men Association, Changamwe Parish. Governed by the CMAK Constitution and
              the parish by-laws.
            </p>
            <p className={styles.verifyNote}>
              <ShieldCheck size={14} aria-hidden="true"/>
              Holding a document from this office? Its number can be checked from the code printed
              on it.
            </p>
          </div>
        </div>
      </footer>
    </div>);
}
