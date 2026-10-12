from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow

OCCUPANCY_STATUSES = [
    ("self_occupied", "Self-occupied"),
    ("rented", "Rented"),
    ("under_development", "Under development"),
    ("vacant", "Vacant"),
    ("under_renovation", "Under renovation"),
    ("other", "Other"),
]
OCCUPANCY_LABELS = dict(OCCUPANCY_STATUSES)

# Initial, provisional records. Names are editable; the count is not hardcoded anywhere else.
INITIAL_PROPERTIES = [
    ("Room 1", "self_occupied"),
    ("Room 2", "rented"),
    ("Room 3", "rented"),
    ("Room 4", "rented"),
    ("Room 5", "rented"),
    ("Room 6", "under_development"),
]


class Property(TimestampMixin, db.Model):
    __tablename__ = "property"
    __table_args__ = (
        db.CheckConstraint(
            "occupancy_status IN ("
            + ",".join(f"'{k}'" for k, _ in OCCUPANCY_STATUSES)
            + ")",
            name="ck_property_occupancy_status",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    mhada_room_no = db.Column(db.String(60))
    ward_name = db.Column(db.String(120))
    ward_number = db.Column(db.String(30))
    address = db.Column(db.Text)
    occupancy_status = db.Column(db.String(30), nullable=False, default="other")
    property_type = db.Column(db.String(60))
    ownership = db.Column(db.String(120))
    notes = db.Column(db.Text)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    archived_at = db.Column(db.DateTime(timezone=True))

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    @property
    def occupancy_label(self) -> str:
        return OCCUPANCY_LABELS.get(self.occupancy_status, self.occupancy_status)

    def archive(self) -> None:
        self.archived_at = utcnow()

    def restore(self) -> None:
        self.archived_at = None


def seed_initial_properties() -> int:
    """Create the six starter records only when the table is completely empty."""
    if db.session.query(Property.id).first() is not None:
        return 0
    for order, (name, status) in enumerate(INITIAL_PROPERTIES, start=1):
        db.session.add(Property(name=name, occupancy_status=status, sort_order=order))
    db.session.commit()
    return len(INITIAL_PROPERTIES)
