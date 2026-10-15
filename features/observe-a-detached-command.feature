Feature: Observe a detached command's exit code later

  An agent starts a long command and goes on with other work. runtag
  records the process outside the repository, and the agent reads the exit
  code when it comes back. runtag never calls the code a pass or a fail.

  Scenario: a detached command's exit code is read back by its id
    Given a git repository to run a command in
    And an empty runtag data directory
    When the agent starts a command that exits with code 3, detached, in that repository
    Then the job is recorded with that repository as its root
    When the agent waits until runtag status reports the job exited
    Then the job's exit code is 3
    And runtag list for that repository includes the job
    When the agent collects exited jobs with runtag gc
    Then runtag status for that id fails and says to run runtag list
