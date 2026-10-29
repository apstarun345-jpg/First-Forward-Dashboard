# v3.124.3
- GV Agents Summary: this-month / last-month issuance now loads the same data as GV Performance (EIR + GV Master + GV REPORT), so "Inactive · this month" is no longer empty.
- GV TLs whose own row is self-supervised (TL ID = own ID) and who lead other agents are TLs, not Direct agents. Direct = no TL, or self with no agents under them.
- GV TL taken from GV REPORT first, Tag Assignment when blank. "Last active" shows the last issuance date.
- TL table: a TL's own stock is counted in the TL's stock, not as one of their agents.
