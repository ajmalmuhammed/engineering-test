import { NextFunction, Request, Response } from "express"
import { getRepository } from "typeorm"
import { GroupStudent } from "../entity/group-student.entity"
import { Group } from "../entity/group.entity"
import { Roll } from "../entity/roll.entity"
import { StudentRollState } from "../entity/student-roll-state.entity"
import { Student } from "../entity/student.entity"
import { CreateGroupStudentInput } from "../interface/group-student-input.interface"
import { CreateGroupInput, UpdateGroupInput } from "../interface/group.interface"

export class GroupController {
  private groupRepository = getRepository(Group)
  private groupStudentRepository = getRepository(GroupStudent)
  private studentRollStateRepository = getRepository(StudentRollState)

  async allGroups(request: Request, response: Response, next: NextFunction) {
    // Task 1:

    // Return the list of all groups
    return this.groupRepository.find()
  }

  async createGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1:

    // Add a Group
    const { body: params } = request
    const createGroupInput: CreateGroupInput = {
      name: params.name,
      number_of_weeks: params.number_of_weeks,
      roll_states: params.roll_states,
      incidents: params.incidents,
      ltmt: params.ltmt
    }

    const group = new Group()
    group.prepareToCreate(createGroupInput)
    return this.groupRepository.save(group)
  }

  async updateGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1:
    // Update a Group

    const { body: params } = request

    try {
      const group = await this.groupRepository.findOne(params.id)
      if (group === undefined) {
        const res1 = { Status: "Failure", Reason: "Group not found. Try again with valid ID" }
        response.status(400).json({ res1 })
        return
      }
      const updateGroupInput: UpdateGroupInput = {
        name: params.name,
        number_of_weeks: params.number_of_weeks,
        roll_states: params.roll_states,
        incidents: params.incidents,
        ltmt: params.ltmt,
      }
      group.prepareToUpdate(updateGroupInput)
      return this.groupRepository.save(group)
    } catch (err) {
      const res = { Status: "Failure", Reason: "Something went wrong. Please try again" }
      return response.status(400).send(res)
    }
  }

  async removeGroup(request: Request, response: Response, next: NextFunction) {
    // Task 1:
    // Delete a Group

    try {
      const group = await this.groupRepository.findOne(request.params.id)

      if (group === undefined) {
        const res1 = { Status: "Failure", Reason: "Group not found. Try again with valid ID" }
        response.status(400).json({ res1 })
        return
      }

      return this.groupRepository.remove(group)
    } catch {
      const res = { Status: "Failure", Reason: "Something went wrong. Please try again" }
      return response.status(400).send(res)
    }
  }

  async getGroupStudents(request: Request, response: Response, next: NextFunction) {
    // Task 1:
    // Return the list of Students that are in a Group
    try {
      const studentDetails = await this.groupStudentRepository
        .createQueryBuilder("group_student")
        .select(["group_student.id as group_id", "student_id", "student.first_name as first_name", "student.last_name as last_name", 'first_name||" "||last_name as full_name'])
        .innerJoin(Student, "student", "group_student.student_id = student.id")
        .getRawMany()

      return studentDetails
    } catch {
      const res = { Status: "Failure", Reason: "Something went wrong. Please try again" }
      return response.status(400).send(res)
    }
  }

  async runGroupFilters(request: Request, response: Response, next: NextFunction) {
    try {
      // Task 2:
      // 1. Clear out the groups (delete all the students from the groups)
      await this.groupStudentRepository.delete({})

      // 2. For each group, query the student rolls to see which students match the filter for the group
      const groupsData = await this.groupRepository.find()

      // checking whether group filters is empty
      if (groupsData.length === 0) {
        const res = { Status: "Failure", Reason: "Group Filters not found. Create group filters and try again" }
        return response.status(400).send(res)
      }

      groupsData.forEach(async (group) => {
        // get the start and enddates
        const { startDate, endDate } = getStartEndDates(group.number_of_weeks)

        // get the operator to be performed.
        const studentRollStates = getStudentRollStates(group)

        // 3. Add the list of students that match the filter to the group
        /**
       * sql query
       * SELECT student_id, count("student_roll_state"."student_id")
        as incident_count FROM "student_roll_state" "student_roll_state"
        INNER JOIN
        "roll" "roll" ON "student_roll_state"."roll_id" = "roll"."id"
        WHERE "roll"."completed_at" BETWEEN '2022-03-19' AND '2022-04-04' AND
        "student_roll_state"."state"
        IN ('late') GROUP BY "student_roll_state"."student_id"
        HAVING incident_count > 0
       */

        const filteredStudents = await this.studentRollStateRepository
          .createQueryBuilder("student_roll_state")
          .select(["student_id", "count(student_roll_state.student_id) as incident_count"])
          .innerJoin(Roll, "roll", "student_roll_state.roll_id = roll.id")
          .where("roll.completed_at BETWEEN :startDate AND :endDate", { startDate, endDate })
          .andWhere("student_roll_state.state IN (:...studentRollStates)", { studentRollStates })
          .groupBy("student_roll_state.student_id")
          .having(`incident_count ${group.ltmt} :incidents`, { incidents: group.incidents })
          .getRawMany()



        filteredStudents.forEach((student) => {
          const createGroupStudentInput: CreateGroupStudentInput = {
            group_id: group.id,
            incident_count: student.incident_count,
            student_id: student.student_id
          }

          const groupStudent = new GroupStudent()
          groupStudent.prepareToCreate(createGroupStudentInput)
          this.groupStudentRepository.save(groupStudent)

          // saving meta data
          this.groupRepository
              .createQueryBuilder()
              .update(Group)
              .set({ run_at: new Date(), student_count: filteredStudents.length })
              .where("id = :id", { id: group.id })
              .execute()
        })
      })
      return "Group filters have succesfully executed!"
    } catch (err) {
      const res = { Status: "Failure", Reason: "Something went wrong. Please try again" }
      return response.status(400).send(res)
    }
  }
}

/**
 * This method converts the comma seperated dates into an array
 * @param group
 * @returns Array of roll_states
 */
function getStudentRollStates(group: Group) {
  if (group.roll_states) return group.roll_states.split(",")
}

/**
 * This method returns the analysis period(start and end date) of the filters
 * @param number_of_weeks the number of weeks for the analysis
 * @returns the startdate and endate of analysis period
 */
function getStartEndDates(number_of_weeks: number): { startDate: string; endDate: string } {
  // startDate is calculated by subtracting the corresponding time for the number_of_weeks provided by staff
  const endDateTime = new Date()
  const startDateTime = new Date(endDateTime.getTime() - number_of_weeks * 7 * (1000 * 60 * 60 * 24))

  // we only want the date so trimming away the time.
  const endDate = endDateTime.toISOString().slice(0, 10)
  const startDate = startDateTime.toISOString().slice(0, 10)

  return { startDate, endDate }
}
