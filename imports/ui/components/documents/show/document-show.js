import { Template } from "meteor/templating"
import { FlowRouter } from "meteor/kadira:flow-router"
import { notify } from "/imports/modules/notifier"
import swal from 'sweetalert'

import { Problems } from "/imports/api/documents/both/problemCollection.js"
import { markAsUnSolved, markAsResolved, updateStatus, claimProblem, unclaimProblem, deleteProblem, watchProblem, unwatchProblem, readFYIProblem, removeClaimer, removeProblemImage } from "/imports/api/documents/both/problemMethods.js"
import { Dependencies } from "/imports/api/documents/both/dependenciesCollection.js"
import { deleteDependency, addDependency } from '/imports/api/documents/both/dependenciesMethods'
import { Comments } from "/imports/api/documents/both/commentsCollection.js"
import { postComment } from "/imports/api/documents/both/commentsMethods.js"

import { getImages } from '/imports/ui/components/uploader/imageUploader'
import '/imports/ui/components/uploader/imageUploader'


import "./document-show.html"
import "./document-comments.html"
import "./resolved-modal.html"
import "./resolved-modal.js"

import './reject-modal.html'
import './reject-modal'

import './reject-solution-modal.html'
import './reject-solution-modal.js'
import './rejected-solutions.html'
import './rejected-solutions.js'

import './blockElement'

Template.documentShow.onCreated(function() {
  this.getDocumentId = () => FlowRouter.getParam("documentId")

  this.autorun(() => {
    SubsCache.subscribe('users')
    SubsCache.subscribe("problems", this.getDocumentId())
    SubsCache.subscribe("comments", this.getDocumentId())
    SubsCache.subscribe('dependencies')
  })

  this.commentInvalidMessage = new ReactiveVar("")

  this.filter = new ReactiveVar('')
  this.invFilter = new ReactiveVar('')
})

Template.documentShow.onRendered(function() {})

Template.documentShow.onDestroyed(function() {})

Template.documentShow.helpers({
    problems: (inverse) => {
        if (Template.instance()[inverse ? 'invFilter' : 'filter'].get()) {
            let dep = Dependencies.find({
                dependencyId: Template.instance().getDocumentId()
            }).fetch()

            let invDep = Dependencies.find({
                problemId: Template.instance().getDocumentId()
            }).fetch()

            return Problems.find({
                _id: {
                    $nin: _.union(invDep.map(i => i.dependencyId), dep.map(i => i.problemId), [Template.instance().getDocumentId()]) // dont show already added problems
                },
                $or: [{
                    summary: new RegExp(Template.instance()[inverse ? 'invFilter' : 'filter'].get().replace(/ /g, '|').replace(/\|$/, ''), 'ig')
                }, {
                    description: new RegExp(Template.instance()[inverse ? 'invFilter' : 'filter'].get().replace(/ /g, '|').replace(/\|$/, ''), 'ig')
                }]
            }).fetch()
        }
    },
    blocking: () => {
        let deps = Dependencies.find({
            dependencyId: Template.instance().getDocumentId()
        }).fetch()

        let tmpDeps = deps.map(i => _.extend(i, {
            indent: 0
        }))

        let depth = 0

        while (tmpDeps.length && depth++ < 25) { // if there happen to be cycles in the dependency tree from old code, limit the depth to prevent stack overflow
            tmpDeps.forEach(i => {
                i.parents = Dependencies.find({
                    dependencyId: i.problemId
                }).fetch().map(j => _.extend(j, {
                    indent: i.indent + 20
                }))
            })

            tmpDeps = _.flatten(tmpDeps.map(i => i.parents))
        }

        return deps
    },
    rejected: () => {
        let problem = Problems.findOne({
            _id: Template.instance().getDocumentId()
        }) || {}

        return problem.status === 'rejected'
    },
    rejectedBy: () => {
        let problem = Problems.findOne({
            _id: Template.instance().getDocumentId()
        }) || {}

        return ((Meteor.users.findOne({
            _id: problem.rejectedBy
        }) || {}).profile || {}).name
    },
    fyi: () => {
        let problem = Problems.findOne({
            _id: Template.instance().getDocumentId()
        }) || {}

        problem.read = problem.read || []

        return {
            firstFive: Meteor.users.find({
                _id: {
                    $in: problem.read
                }
            }, {
                limit: 5,
                sort: {
                    'profile.name': -1
                }
            }).fetch().map(i => `<a href="#">${i.profile.name}</a>`).toString().replace(/,/ig, ', '),
            more: {
                count: problem.read.length > 5 ? problem.read.length - 5 : 0,
                usernames: Meteor.users.find({
                    _id: {
                        $in: problem.read
                    }
                }, {
                    skip: 5,
                    sort: {
                        'profile.name': -1
                    }
                }).fetch().map(i => i.profile.name).toString().replace(/,/ig, ', ')
            }
        }
    },
    problem() {
        return Problems.findOne({ _id: Template.instance().getDocumentId() }) || {}
    },
    dependencies() {
      return Dependencies.find({ problemId: Template.instance().getDocumentId() }) || []
    },
    comments() {
        return Comments.find({ problemId: Template.instance().getDocumentId() }) || {}
    },
    claimButton(problem) {
      if (problem.fyiProblem) {
        if (!~(problem.read || []).indexOf(Meteor.userId())) {
            return '<a class="btn btn-sm btn-primary readProblem" href="#" role="button">Got it</a>'
        } else {
            return '<a class="btn btn-sm btn-primary disabled" href="#" role="button">Understood</a>'
        }
      } else {
          if (problem.status !== 'closed') {
            if (problem.claimed && problem.claimedBy === Meteor.userId()) {
                return '<a class="btn btn-sm btn-primary unclaimProblem" href="#" role="button">Unclaim</a>'
            } else if (problem.claimed) {
                return '<a class="btn btn-sm btn-success disabled" href="#" role="button">Claimed</a>'
            } else {
                return '<a class="btn btn-sm btn-success claimProblem" href="#" role="button">Claim</a>'
            }
          }
      }
    },
    watchButton(problem) {
      if (~(problem.subscribers || []).indexOf(Meteor.userId())) {
        return '<a class="btn btn-sm btn-primary unwatchProblem" href="#" role="button">Unwatch</a>'
      } else {
        return '<a class="btn btn-sm btn-primary watchProblem" href="#" role="button">Watch</a>'
      }
    },
    markAsResolved(problem) {
        if (problem.status !== 'ready for review' && problem.status !== 'closed') {
            return '<button data-toggle="modal" data-target="#markAsSolvedModal" class="btn btn-sm btn-success" role="button"> I have solved this problem </button>'
        }
    },
    unsolve(problem) {
        if (problem.status == 'ready for review' && problem.status !== 'closed') {
            return '<button id="unSolveProblem" class="btn btn-sm btn-warning" role="button"> Unsolve </button>'
        }
    },
    statusButton(problem) {
        if (problem.status === 'closed') {
          return '<a id="openProblem" class="btn btn-sm btn-success toggleProblem" role="button" href> Open </a>'
        }
    },
    resolvedByUser(problem) {
        let user = Meteor.users.findOne({ _id : problem.resolvedBy })
        return user.profile.name
    },
    commentInvalidMessage() {
        return Template.instance().commentInvalidMessage.get()
    },
    isSolutionAccepted(problem) {
        if (problem.hasAcceptedSolution) {
            return `<i class="nav-icon icon-check text-success"></i>`
        }

        return `<i class="nav-icon icon-info text-warning"></i>`
    },
    acceptSolution(problem) {
        if (problem.createdBy === Meteor.userId() && problem.status === 'ready for review') {
            return `
                <hr>
                <a id="closeProblem" class="btn btn-sm btn-success toggleProblem" role="button" href> accept this solution</a>
                <a id="rejectSolution" data-toggle="modal" data-target="#rejectSolutionModal" class="btn btn-sm btn-danger" role="button" href> reject this solution</a>
            `
        }
    },
    canDeleteDep: problem => {
        let user = Meteor.users.findOne({
            _id: Meteor.userId()
        }) || {}

        return problem.createdBy === Meteor.userId() || user.moderator
    }
})

Template.documentShow.events({
    'keyup #dependency' (event) {
        Template.instance().filter.set(event.target.value)
    },
    'keyup #invDependency' (event) {
        Template.instance().invFilter.set(event.target.value)
    },
    'click .dependency' (event) {
        event.preventDefault()

        addDependency.call({
            pId: Template.instance().getDocumentId(),
            dId: event.target.id
        }, (err, res) => {
            if (!err) {
                $('#dependency').val('')
                $('#dependency').trigger('keyup')

                window.scroll({ top: 0 })
            } else {
                notify(err.reason || err.message, 'error')
            }
        })
    },
    'click .invDependency': (event, templateInstance) => {
        event.preventDefault()

        addDependency.call({
            pId: event.target.id,
            dId: Template.instance().getDocumentId()
        }, (err, res) => {
            if (!err) {
                $('#invDependency').val('')
                $('#invDependency').trigger('keyup')

                window.scroll({ top: 0 })
            } else {
                notify(err.reason || err.message, 'error')
            }
        })
    },
  'click .remove-problem-image': (event, templateInstance) => {
    event.preventDefault()

    removeProblemImage.call({
      _id: $(event.currentTarget).data('id'),
      image: $(event.currentTarget).data('image')
    }, (err, data) => {
      if (err) {
        console.log(err)
      }
    })
  },
  'click .remove-dep': function (event, templateInstance) {
    event.preventDefault()

    swal({
        text: `Are you sure you want to remove this dependency?`,
        icon: "warning",
        buttons: true,
        dangerMode: true,
        showCancelButton: true
    }).then(confirmed => {
        if (confirmed) {
            deleteDependency.call({
                id: this._id
            }, (err, data) => {
                if (err) { console.log(err) }
            })
        }
    })
  },
    "click .toggleProblem" (event) {
        var status = event.target.id === 'closeProblem' ? 'closed' : 'open';
        let problem = Problems.findOne({ _id: Template.instance().getDocumentId() })
        let claimer = Meteor.users.findOne({
            _id: problem.claimedBy
        }) || {}
        let info = ''

        if (Meteor.userId()) {
            swal({
                    text: `Was this problem actually solved by ${(claimer.profile || {}).name}?`,
                    icon: "warning",
                    buttons: true,
                    dangerMode: true,
                    showCancelButton: true
                })
                .then(confirmed => {
                    if (status === 'closed' && claimer && confirmed) {
                        info = 'actually-solved'
                    }

                    updateStatus.call({
                        problemId: problem._id,
                        status: status,
                        info: info
                    }, (error, response) => {
                        if (error) { console.log(error) }
                    })
                });


        }
    },
    "click #resolveProblem" (event) {
        let problem = Problems.findOne({ _id : Template.instance().getDocumentId() })

        if (Meteor.userId()) {
            markAsResolved.call({
                problemId: problem._id,
                claimerId: problem.claimedBy
            }, (error, response) => {
                if(error) { console.log(error.details) }
            })
        }
    },
    "click #unSolveProblem" (event) {
        let problem = Problems.findOne({ _id : Template.instance().getDocumentId() })

        if (Meteor.userId()) {
            markAsUnSolved.call({
                problemId: problem._id,
                claimerId: problem.claimedBy
            }, (error, response) => {
                if(error) { console.log(error.details) }
            })
        }
    },
    'click .readProblem': (event, templateInstance) => {
        if (Meteor.userId()) {
            readFYIProblem.call({
                _id: templateInstance.getDocumentId()
            }, (error, response) => {
                if(error) { console.log(error.details) }
            })
        }
    },
    "click .unwatchProblem" (event, instance) {
        event.preventDefault()

        if (Meteor.userId()) {
            unwatchProblem.call({
                _id: Template.instance().getDocumentId(),
            }, (error, result) => {
                if (error) {
                    if (error.details) {
                        console.error(error.details)
                   } else {
                        console.error(error)
                    }
                }
            })
        } else {
            notify('Must be logged in!', 'error')
        }
    },
    "click .watchProblem" (event, instance) {
        event.preventDefault()

        if (Meteor.userId()) {
            watchProblem.call({
                _id: Template.instance().getDocumentId(),
            }, (error, result) => {
                if (error) {
                    if (error.details) {
                        console.error(error.details)
                   } else {
                        console.error(error)
                    }
                }
            })
        } else {
            notify('Must be logged in!', 'error')
        }
    },
    "click .documentCommentBtn" (event, instance) {
        event.preventDefault()

        if (Meteor.userId()){
                let problemId = Template.instance().getDocumentId()
                var commentValue = $('#comments').val();

                if (commentValue.length == 0) {
                    Template.instance().commentInvalidMessage.set("Please type something before posting")
                } else if (commentValue.length <= 3) {
                    Template.instance().commentInvalidMessage.set("The comment is too small")
                } else if (commentValue.length > 500) {
                    Template.instance().commentInvalidMessage.set("The comment is too long")
                } else {
                    Template.instance().commentInvalidMessage.set("")

                    postComment.call({
                        problemId: problemId,
                        comment: commentValue,
                        images: getImages(true)
                    }, (error, result) => {
                        if (error) {
                            if (error.details) {
                                console.error(error.details)
                            } else {
                                console.error(error)
                            }
                        }else{
                            $('#comments').val("");
                        }
                    })
                }
            } else {
                notify("Must be logged in!", "error")
            }
    },

    "click .js-delete-document" (event, instance) {
        event.preventDefault()
        let problemId = Template.instance().getDocumentId()

        swal({
                text: "Are you sure you want to delete this problem?",
                icon: "warning",
                buttons: true,
                dangerMode: true,
                showCancelButton: true
            })
            .then(confirmed => {
                if (confirmed) {

                    if (Meteor.userId()) {

                        deleteProblem.call({ id: problemId }, (error, result) => {
                            if (error) {
                                if (error.details) {
                                    console.error(error.details)
                                }
                            } else {
                                FlowRouter.go('/');
                            }
                        })
                    }
                }
            });
    },

    "click .claimProblem" (event, instance) {
     event.preventDefault()

     if (Meteor.userId()) {
         let problemId = Template.instance().getDocumentId()
         swal({
                 text: "Are you sure you want to claim this problem?",
                 icon: "success",
                 buttons: true,
                 dangerMode: true,
                 showCancelButton: true
             })
             .then(confirmed => {
                     if (confirmed) {

                         if (Meteor.userId()) {
                             swal({
                                 text: 'How many minutes do you think you need to spend working on this problem?',
                                 content: {
                                     element: "input",
                                     attributes: {
                                         placeholder: "Enter the estimated workload (in minutes)",
                                         type: "number",
                                     }
                                 },
                                 button: {
                                     text: "Estimate",
                                     closeModal: true,
                                 },
                             }).then(estimate => {

                                 if (!estimate) throw null;

                                 claimProblem.call({
                                     _id: problemId,
                                     estimate: Number(estimate)
                                 }, (error, result) => {
                                     if (error) {
                                         if (error.details) {
                                             console.error(error.details)
                                         } else {
                                             notify('Problem claimed successfully', 'success');
                                         }
                                     }
                                 })

                             })

                        }
                    }
                });
        } else {
            notify("Must be logged in!", "error")
        }
    },

    "click .unclaimProblem" (event, instance) {
        event.preventDefault()

        if (Meteor.userId()) {
            let problemId = Template.instance().getDocumentId()
            swal({
                    text: "Are you sure you want to unclaim this problem?",
                    icon: "warning",
                    buttons: true,
                    dangerMode: true,
                    showCancelButton: true
                })
                .then(confirmed => {
                    if (confirmed) {

                        if (Meteor.userId()) {

                            unclaimProblem.call({
                                _id: problemId
                            }, (error, result) => {
                                if (error) {
                                    if (error.details) {
                                        console.error(error.details)
                                    } else {
                                        notify('Problem unclaimed successfully', 'success');
                                    }
                                }
                            })
                        }
                    }
                });
        } else {
            notify("Must be logged in!", "error")
        }
    },

    "click #removeClaimer" (event) {
        event.preventDefault()

        if (Meteor.userId()) {
            let problemId = Template.instance().getDocumentId()

            swal({
                text: "Are you sure you want to remove claimer from this problem?",
                icon: "warning",
                buttons: true,
                dangerMode: true,
                showCancelButton: true
            }).then((confirmed) => {
                if (confirmed) {
                    removeClaimer.call({ problemId: problemId }, (err, response) => {
                        if (err) { notify(err.message, 'error'); }
                    })
                }
            })
        }
    }

})
