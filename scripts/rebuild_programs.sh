#!/bin/sh
# Rebuild every program's requirements after editing source/majors.py (or to pick up new courses).
#   1. source/build_catalog.py -> source/catalog.js from a pinned Cornell DTI CoursePlan revision
#   2. scripts/export_json.py  -> courses.json and programs/*.json
#   3. scripts/coverage_list.py -> programs/coverage.json
set -e
cd "$(dirname "$0")/.."
revision=fb16540f7d477c629ce798c3ba12ad870b793422
course_plan=.cache/course-plan
if [ ! -d "$course_plan/.git" ]; then
  git init -q "$course_plan"
  git -C "$course_plan" sparse-checkout set --no-cone \
    /src/assets/courses/full-courses.json /src/assets/courses/rosters.json /src/requirements/decorated-requirements.json
fi
if ! git -C "$course_plan" cat-file -e "$revision^{commit}" 2>/dev/null; then
  git -C "$course_plan" fetch --depth 1 https://github.com/cornell-dti/course-plan.git "$revision"
fi
git -C "$course_plan" checkout --quiet --detach "$revision"
python3 source/build_catalog.py "$course_plan"
python3 scripts/export_json.py
python3 scripts/coverage_list.py
