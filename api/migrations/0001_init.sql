CREATE TABLE homes (
  id   TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT pk_homes PRIMARY KEY (id),
  CONSTRAINT ck_homes_name_not_blank CHECK (length(trim(name)) > 0)
) STRICT;

-- seq keeps the order members were added; timestamps can tie.
CREATE TABLE members (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  id      TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  CONSTRAINT uq_members_id UNIQUE (id),
  CONSTRAINT uq_members_id_home UNIQUE (id, home_id),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_members_name_not_blank CHECK (length(trim(name)) > 0)
) STRICT;

CREATE INDEX idx_members_home_seq ON members (home_id, seq);

CREATE TABLE bills (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL,
  home_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT uq_bills_id UNIQUE (id),
  CONSTRAINT uq_bills_id_home UNIQUE (id, home_id),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_bills_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT ck_bills_total_positive CHECK (total_cents > 0)
) STRICT;

CREATE INDEX idx_bills_home_seq ON bills (home_id, seq);

CREATE TABLE shares (
  id              TEXT NOT NULL,
  home_id         TEXT NOT NULL,
  bill_id         TEXT NOT NULL,
  member_id       TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  paid_at         TEXT,
  idempotency_key TEXT,
  CONSTRAINT pk_shares PRIMARY KEY (id),
  -- home_id in both keys stops a bill being charged to a member of another home.
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id, home_id) REFERENCES bills (id, home_id),
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id, home_id) REFERENCES members (id, home_id),
  CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id),
  -- Zero is allowed: 2 cents between 3 members gives 1, 1, 0.
  CONSTRAINT ck_shares_amount_not_negative CHECK (amount_cents >= 0),
  CONSTRAINT ck_shares_paid_has_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
) STRICT;

CREATE INDEX idx_shares_member_unpaid ON shares (member_id) WHERE paid_at IS NULL;
