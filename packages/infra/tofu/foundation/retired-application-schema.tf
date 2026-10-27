# Destructive retirement of the isolated application schema only.
# Review an encrypted saved plan and back up application data before applying.
# Existing state dependencies order Atlas table retirement before schema removal.
removed {
  from = atlas_schema.fleet
  lifecycle { destroy = true }
}
removed {
  from = postgresql_schema.fleet
  lifecycle { destroy = true }
}
